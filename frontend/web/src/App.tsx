import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface LoyaltyPoint {
  id: string;
  name: string;
  encryptedValue: string;
  publicValue1: number;
  publicValue2: number;
  description: string;
  creator: string;
  timestamp: number;
  isVerified?: boolean;
  decryptedValue?: number;
  brand: string;
  category: string;
}

interface PointStats {
  totalPoints: number;
  verifiedPoints: number;
  activeBrands: number;
  totalValue: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [points, setPoints] = useState<LoyaltyPoint[]>([]);
  const [filteredPoints, setFilteredPoints] = useState<LoyaltyPoint[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingPoint, setCreatingPoint] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newPointData, setNewPointData] = useState({ 
    name: "", 
    value: "", 
    brand: "Nike", 
    category: "Fashion" 
  });
  const [selectedPoint, setSelectedPoint] = useState<LoyaltyPoint | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [brandFilter, setBrandFilter] = useState("all");
  const [operationHistory, setOperationHistory] = useState<string[]>([]);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  const brands = ["Nike", "Adidas", "Apple", "Samsung", "Starbucks", "Amazon"];
  const categories = ["Fashion", "Tech", "Food", "Lifestyle", "Entertainment"];

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        console.error('FHEVM initialization failed:', error);
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  useEffect(() => {
    filterPoints();
  }, [points, searchTerm, brandFilter]);

  const filterPoints = () => {
    let filtered = points;
    
    if (searchTerm) {
      filtered = filtered.filter(point => 
        point.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        point.brand.toLowerCase().includes(searchTerm.toLowerCase()) ||
        point.description.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }
    
    if (brandFilter !== "all") {
      filtered = filtered.filter(point => point.brand === brandFilter);
    }
    
    setFilteredPoints(filtered);
  };

  const addToHistory = (operation: string) => {
    setOperationHistory(prev => [
      `${new Date().toLocaleTimeString()}: ${operation}`,
      ...prev.slice(0, 9)
    ]);
  };

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const pointsList: LoyaltyPoint[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          pointsList.push({
            id: businessId,
            name: businessData.name,
            encryptedValue: businessId,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            description: businessData.description,
            creator: businessData.creator,
            timestamp: Number(businessData.timestamp),
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0,
            brand: brands[Number(businessData.publicValue1) % brands.length] || "Unknown",
            category: categories[Number(businessData.publicValue2) % categories.length] || "General"
          });
        } catch (e) {
          console.error('Error loading point data:', e);
        }
      }
      
      setPoints(pointsList);
      addToHistory(`Loaded ${pointsList.length} loyalty points`);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createPoint = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingPoint(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating encrypted loyalty point..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const pointValue = parseInt(newPointData.value) || 0;
      const businessId = `point-${Date.now()}`;
      const brandIndex = brands.indexOf(newPointData.brand);
      const categoryIndex = categories.indexOf(newPointData.category);
      
      const encryptedResult = await encrypt(contractAddress, address, pointValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newPointData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        brandIndex,
        categoryIndex,
        `Loyalty point for ${newPointData.brand} - ${newPointData.category}`
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Loyalty point created successfully!" });
      addToHistory(`Created point: ${newPointData.name} (${pointValue} points)`);
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewPointData({ name: "", value: "", brand: "Nike", category: "Fashion" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingPoint(false); 
    }
  };

  const decryptData = async (pointId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const pointData = await contractRead.getBusinessData(pointId);
      if (pointData.isVerified) {
        const storedValue = Number(pointData.decryptedValue) || 0;
        setTransactionStatus({ visible: true, status: "success", message: "Data already verified on-chain" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        addToHistory(`Verified existing point: ${storedValue} points`);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(pointId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(pointId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      addToHistory(`Decrypted point: ${clearValue} points`);
      
      setTransactionStatus({ visible: true, status: "success", message: "Data decrypted and verified successfully!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Data is already verified on-chain" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
  };

  const callIsAvailable = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const result = await contract.isAvailable();
      setTransactionStatus({ visible: true, status: "success", message: "Contract is available and working!" });
      addToHistory("Checked contract availability: Success");
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Contract call failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const calculateStats = (): PointStats => {
    const totalPoints = points.length;
    const verifiedPoints = points.filter(p => p.isVerified).length;
    const activeBrands = new Set(points.map(p => p.brand)).size;
    const totalValue = points.reduce((sum, p) => sum + (p.decryptedValue || p.publicValue1 * 10), 0);
    
    return { totalPoints, verifiedPoints, activeBrands, totalValue };
  };

  const renderStats = () => {
    const stats = calculateStats();
    
    return (
      <div className="stats-grid">
        <div className="stat-card neon-purple">
          <div className="stat-icon">🔢</div>
          <div className="stat-content">
            <div className="stat-value">{stats.totalPoints}</div>
            <div className="stat-label">Total Points</div>
          </div>
        </div>
        
        <div className="stat-card neon-blue">
          <div className="stat-icon">✅</div>
          <div className="stat-content">
            <div className="stat-value">{stats.verifiedPoints}</div>
            <div className="stat-label">Verified</div>
          </div>
        </div>
        
        <div className="stat-card neon-pink">
          <div className="stat-icon">🏪</div>
          <div className="stat-content">
            <div className="stat-value">{stats.activeBrands}</div>
            <div className="stat-label">Active Brands</div>
          </div>
        </div>
        
        <div className="stat-card neon-green">
          <div className="stat-icon">💰</div>
          <div className="stat-content">
            <div className="stat-value">{stats.totalValue}</div>
            <div className="stat-label">Total Value</div>
          </div>
        </div>
      </div>
    );
  };

  const renderBrandChart = () => {
    const brandData = brands.map(brand => ({
      brand,
      count: points.filter(p => p.brand === brand).length,
      value: points.filter(p => p.brand === brand).reduce((sum, p) => sum + (p.decryptedValue || p.publicValue1 * 10), 0)
    })).filter(data => data.count > 0);

    return (
      <div className="brand-chart">
        <h3>Brand Distribution</h3>
        <div className="chart-bars">
          {brandData.map((data, index) => (
            <div key={data.brand} className="chart-bar-container">
              <div className="bar-label">{data.brand}</div>
              <div 
                className="chart-bar" 
                style={{ 
                  width: `${(data.count / Math.max(...brandData.map(d => d.count))) * 100}%`,
                  background: `linear-gradient(90deg, var(--neon-${['purple','blue','pink','green'][index % 4]}), var(--neon-${['blue','pink','green','purple'][index % 4]}))`
                }}
              >
                <span className="bar-value">{data.count} points</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>Confidential Loyalty Points 🔐</h1>
            <p>FHE-Protected Brand Points Exchange</p>
          </div>
          <ConnectButton />
        </header>
        
        <div className="connection-prompt">
          <div className="neon-glow">
            <h2>🔐 Connect Your Wallet</h2>
            <p>Securely manage your encrypted loyalty points across brands</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="neon-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
      </div>
    );
  }

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo-section">
          <h1>Confidential Loyalty Points 🔐</h1>
          <p>FHE-Protected Cross-Brand Points Exchange</p>
        </div>
        
        <div className="header-controls">
          <button className="neon-btn" onClick={callIsAvailable}>
            Check Contract
          </button>
          <ConnectButton />
        </div>
      </header>

      <main className="main-content">
        <section className="dashboard-section">
          <div className="section-header">
            <h2>📊 Points Dashboard</h2>
            <button 
              className="neon-btn create-btn"
              onClick={() => setShowCreateModal(true)}
            >
              + Add Points
            </button>
          </div>
          
          {renderStats()}
          {renderBrandChart()}
        </section>

        <section className="controls-section">
          <div className="search-filters">
            <div className="search-box">
              <input
                type="text"
                placeholder="🔍 Search points..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="neon-input"
              />
            </div>
            
            <select 
              value={brandFilter} 
              onChange={(e) => setBrandFilter(e.target.value)}
              className="neon-select"
            >
              <option value="all">All Brands</option>
              {brands.map(brand => (
                <option key={brand} value={brand}>{brand}</option>
              ))}
            </select>
            
            <button 
              onClick={loadData} 
              className="neon-btn secondary"
              disabled={isRefreshing}
            >
              {isRefreshing ? "🔄" : "Refresh"}
            </button>
          </div>
        </section>

        <section className="points-section">
          <h2>🎯 Your Loyalty Points</h2>
          <div className="points-grid">
            {filteredPoints.length === 0 ? (
              <div className="no-points">
                <p>No loyalty points found</p>
                <button 
                  className="neon-btn"
                  onClick={() => setShowCreateModal(true)}
                >
                  Create Your First Points
                </button>
              </div>
            ) : (
              filteredPoints.map((point, index) => (
                <PointCard 
                  key={point.id}
                  point={point}
                  index={index}
                  onSelect={setSelectedPoint}
                  onDecrypt={decryptData}
                />
              ))
            )}
          </div>
        </section>

        <section className="history-section">
          <h2>📋 Operation History</h2>
          <div className="history-list">
            {operationHistory.length === 0 ? (
              <p>No operations yet</p>
            ) : (
              operationHistory.map((op, idx) => (
                <div key={idx} className="history-item">
                  {op}
                </div>
              ))
            )}
          </div>
        </section>

        <section className="partners-section">
          <h2>🤝 Partner Brands</h2>
          <div className="partners-grid">
            {brands.map((brand, idx) => (
              <div key={brand} className="partner-card">
                <div className={`partner-logo brand-${idx % 4}`}>{brand.charAt(0)}</div>
                <span>{brand}</span>
              </div>
            ))}
          </div>
        </section>
      </main>

      {showCreateModal && (
        <CreatePointModal
          onSubmit={createPoint}
          onClose={() => setShowCreateModal(false)}
          creating={creatingPoint || isEncrypting}
          pointData={newPointData}
          setPointData={setNewPointData}
          brands={brands}
          categories={categories}
        />
      )}

      {selectedPoint && (
        <PointDetailModal
          point={selectedPoint}
          onClose={() => setSelectedPoint(null)}
          onDecrypt={decryptData}
        />
      )}

      {transactionStatus.visible && (
        <div className={`transaction-toast ${transactionStatus.status}`}>
          <div className="toast-content">
            <span className="toast-icon">
              {transactionStatus.status === "pending" && "⏳"}
              {transactionStatus.status === "success" && "✅"}
              {transactionStatus.status === "error" && "❌"}
            </span>
            {transactionStatus.message}
          </div>
        </div>
      )}
    </div>
  );
};

const PointCard: React.FC<{
  point: LoyaltyPoint;
  index: number;
  onSelect: (point: LoyaltyPoint) => void;
  onDecrypt: (pointId: string) => Promise<number | null>;
}> = ({ point, index, onSelect, onDecrypt }) => {
  const [decrypting, setDecrypting] = useState(false);

  const handleDecrypt = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setDecrypting(true);
    await onDecrypt(point.id);
    setDecrypting(false);
  };

  return (
    <div 
      className={`point-card neon-glow-${index % 4}`}
      onClick={() => onSelect(point)}
    >
      <div className="card-header">
        <div className="point-brand">{point.brand}</div>
        <div className={`point-status ${point.isVerified ? 'verified' : 'encrypted'}`}>
          {point.isVerified ? '✅ Verified' : '🔒 Encrypted'}
        </div>
      </div>
      
      <div className="point-name">{point.name}</div>
      <div className="point-category">{point.category}</div>
      
      <div className="point-value">
        {point.isVerified ? (
          <span className="decrypted-value">{point.decryptedValue} points</span>
        ) : (
          <span className="encrypted-value">🔒 FHE Encrypted</span>
        )}
      </div>
      
      <button 
        className={`decrypt-btn ${point.isVerified ? 'verified' : ''}`}
        onClick={handleDecrypt}
        disabled={decrypting}
      >
        {decrypting ? 'Decrypting...' : point.isVerified ? 'Verified' : 'Decrypt'}
      </button>
    </div>
  );
};

const CreatePointModal: React.FC<{
  onSubmit: () => void;
  onClose: () => void;
  creating: boolean;
  pointData: any;
  setPointData: (data: any) => void;
  brands: string[];
  categories: string[];
}> = ({ onSubmit, onClose, creating, pointData, setPointData, brands, categories }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setPointData({ ...pointData, [name]: value });
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal neon-glow">
        <div className="modal-header">
          <h2>Add New Loyalty Points</h2>
          <button onClick={onClose} className="close-btn">×</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>🔐 FHE Encryption</strong>
            <p>Point value will be encrypted with Zama FHE technology</p>
          </div>
          
          <div className="form-group">
            <label>Point Name</label>
            <input
              type="text"
              name="name"
              value={pointData.name}
              onChange={handleChange}
              className="neon-input"
              placeholder="Enter point name..."
            />
          </div>
          
          <div className="form-group">
            <label>Point Value (Integer)</label>
            <input
              type="number"
              name="value"
              value={pointData.value}
              onChange={handleChange}
              className="neon-input"
              placeholder="Enter point value..."
              min="0"
              step="1"
            />
          </div>
          
          <div className="form-group">
            <label>Brand</label>
            <select name="brand" value={pointData.brand} onChange={handleChange} className="neon-select">
              {brands.map(brand => (
                <option key={brand} value={brand}>{brand}</option>
              ))}
            </select>
          </div>
          
          <div className="form-group">
            <label>Category</label>
            <select name="category" value={pointData.category} onChange={handleChange} className="neon-select">
              {categories.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="neon-btn secondary">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || !pointData.name || !pointData.value}
            className="neon-btn primary"
          >
            {creating ? "Encrypting..." : "Create Points"}
          </button>
        </div>
      </div>
    </div>
  );
};

const PointDetailModal: React.FC<{
  point: LoyaltyPoint;
  onClose: () => void;
  onDecrypt: (pointId: string) => Promise<number | null>;
}> = ({ point, onClose, onDecrypt }) => {
  const [decrypting, setDecrypting] = useState(false);

  const handleDecrypt = async () => {
    setDecrypting(true);
    await onDecrypt(point.id);
    setDecrypting(false);
  };

  return (
    <div className="modal-overlay">
      <div className="detail-modal neon-glow">
        <div className="modal-header">
          <h2>Point Details</h2>
          <button onClick={onClose} className="close-btn">×</button>
        </div>
        
        <div className="modal-body">
          <div className="point-info">
            <div className="info-row">
              <span>Name:</span>
              <strong>{point.name}</strong>
            </div>
            <div className="info-row">
              <span>Brand:</span>
              <strong>{point.brand}</strong>
            </div>
            <div className="info-row">
              <span>Category:</span>
              <strong>{point.category}</strong>
            </div>
            <div className="info-row">
              <span>Status:</span>
              <strong className={point.isVerified ? 'verified' : 'encrypted'}>
                {point.isVerified ? '✅ On-chain Verified' : '🔒 FHE Encrypted'}
              </strong>
            </div>
            <div className="info-row">
              <span>Point Value:</span>
              <strong>
                {point.isVerified ? 
                  `${point.decryptedValue} points` : 
                  '🔒 Encrypted (FHE Protected)'
                }
              </strong>
            </div>
            <div className="info-row">
              <span>Created:</span>
              <strong>{new Date(point.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
          </div>
          
          <div className="fhe-explanation">
            <h3>🔐 FHE Protection</h3>
            <p>This point value is encrypted using Fully Homomorphic Encryption. 
            Brands cannot see your actual point values while still enabling secure exchanges.</p>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="neon-btn secondary">Close</button>
          {!point.isVerified && (
            <button 
              onClick={handleDecrypt} 
              disabled={decrypting}
              className="neon-btn primary"
            >
              {decrypting ? 'Decrypting...' : 'Decrypt Points'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;


